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

var folder = path.join('/stockflare/data', 'dynamodb_backup');


var program = require('commander');

var lawgs = require('./aws_logger');

program
  .version('0.0.1')
  .option('-t, --table [string]', 'DynamoDB Table to backup')
  .option('-b, --bucket [string]', 'Bucket top upload bakup file to, defaults to  ${BACKUP_FILE_BUCKET}', bucket_env)
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

var file_name = path.join(folder, program.table + moment().format() + '.csv' );

// Delete the file if it already exists
if (fs.existsSync(file_name)) {
  fs.unlinkSync(file_name);
}

// Create the Stream to write the file
var csvStream = csv.format({headers: false}),
    writableStream = fs.createWriteStream(file_name);

// Process the CSV file when writing has completed
writableStream.on("finish", function(){
  logger.log(program.logStream,"DONE!");

  exit(0);
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
        exit(1);
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
