#!/usr/bin/env node

/**
 * Module dependencies.
 */
var region_env = process.env.AWS_REGION;
var bucket_env  = process.env.BACKUP_FILE_BUCKET;
var log_group_env = process.env.CLOUDWATCH_LOG_GROUP;
var log_stream_env = process.env.CLOUDWATCH_LOG_STREAM;
var AWS = require('aws-sdk');
var _ = require('underscore');
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var moment = require('moment');
var csv = require('fast-csv');
var Fiber = require('fibers');

var folder = path.join('/stockflare/data', 'dynamodb_backup');


var program = require('commander');

var lawgs = require('./aws_logger');

program
  .version('0.0.1')
  .option('-t, --table [string]', 'DynamoDB Table to backup')
  .option('-b, --bucket [string]', 'Bucket top upload backup file to, defaults to  ${BACKUP_FILE_BUCKET}', bucket_env)
  .option('-l, --log-group [string]', 'CloudWatch Log Group to recive log entries, defaults to ${CLOUDWATCH_LOG_GROUP}', log_group_env)
  .option('-s, --log-stream [string]', 'CloudWatch Log Stream to recive log entries, defaults to ${CLOUDWATCH_LOG_STREAM}', log_stream_env)
  .option('-e, --encode', 'Encode the row data in Base64')
  .option('-r, --region', 'Region for AWS API calls, defaults to ${BACKUP_FILE_BUCKET}', region_env)
  .parse(process.argv);

var s3 = new AWS.S3({
  region: program.region
});

var dynamodb = new AWS.DynamoDB({region: program.region});

// Greate the logger
var logger = console;
if (!_.isUndefined(program.logGroup)) {
  lawgs.config({
  	aws: {
  		region: program.region
  	}
  });
  logger = lawgs.getOrCreate(program.logGroup);
  logger.config({
  	// Shows the debugging messages
  	showDebugLogs: false, /* Default to false */
  	// Change the frequency of log upload, regardless of the batch size
  	uploadMaxTimer: 1000, /* Defaults to 5000ms */
  	// Max batch size. An upload will be triggered if this limit is reached within the max upload time
  	uploadBatchSize: 10 /* Defaults to 500 */
  });
}

logger.log(program.logStream,program);

// Create the folder for the backup file if needed
if (!fs.existsSync(folder)) {
  mkdirp.sync(folder);
}

var file_name = program.table + '_' + moment().format() + '.csv';
var full_file_path = path.join(folder, file_name );

// Delete the file if it already exists
if (fs.existsSync(full_file_path)) {
  fs.unlinkSync(full_file_path);
}

// Create the Stream to write the file
var csvStream = csv.format({headers: false}),
    writableStream = fs.createWriteStream(full_file_path);

// Process the CSV file when writing has completed
writableStream.on("finish", function(){
  logger.log(program.logStream,"DONE! - Uploading file to S3");
  var s3_full_file_path = path.join(program.table, file_name);
  var body = fs.createReadStream(full_file_path);

  var s3obj = new AWS.S3({params: {Bucket: program.bucket, Key: s3_full_file_path}});
  s3obj.upload({Body: body}).on('httpUploadProgress', function(evt) {
    logger.log(program.logStream, evt);
  }).send(function(err, data) {
      logger.log(program.logStream, err);
      logger.log(program.logStream, data);
      if (err) {
        logger.log(program.logStream,"Upload file to S3 - Failed");
        exit(1);
      } else {
        logger.log(program.logStream,"Upload file to S3 - Complete");
        exit(0);
      }
   });
});

csvStream.pipe(writableStream);

// Set up the table scanning
var params = {
    TableName: program.table
};
dynamodb.scan(params, onScan);

// Function to Scan the table and continue scanning when more than one page
function onScan(err, data) {
    if (err) {
        console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
        // ON provisioned throughput error then just pause and try again
        if (err.code === 'ProvisionedThroughputExceededException') {
          Fiber(function() {
            sleep(10000);
          }).run();
          dynamodb.scan(params, onScan);
        }

    } else {
        logger.log(program.logStream,"Scan succeeded.");
        data.Items.forEach(function(row) {
          if (program.encode === true) {
            csvStream.write({row: new Buffer(JSON.stringify(row)).toString('base64')});
          } else {
            csvStream.write({row: JSON.stringify(row)});
          }
        });

        // continue scanning if we have more movies
        if (!_.isUndefined(data.LastEvaluatedKey)) {
            logger.log(program.logStream,"Scanning for more.");
            params.ExclusiveStartKey = data.LastEvaluatedKey;
            dynamodb.scan(params, onScan);
        } else {
          logger.log(program.logStream,"Completed scanning table");
          csvStream.end();
        }
    }
}

function exit(status) {
  // make sure to sleep for 10 seconds so that logs flush
  setTimeout(function() {
      process.exit(status);
  }, (10 * 1000));
}

function sleep(ms) {
    var fiber = Fiber.current;
    setTimeout(function() {
        fiber.run();
    }, ms);
    Fiber.yield();
}
