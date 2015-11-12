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
var when = require('when');
var Fiber = require('fibers');


var folder = path.join('/stockflare/data', 'dynamodb_backup');


var program = require('commander');

var lawgs = require('./aws_logger');

program
  .version('0.0.1')
  .option('-t, --table [string]', 'DynamoDB Table to restore')
  .option('-b, --bucket [string]', 'Bucket top download backup file to, defaults to  ${BACKUP_FILE_BUCKET}', bucket_env)
  .option('-f, --file [string]', 'The file to restore, including any s3 folder paths')
  .option('-l, --log-group [string]', 'CloudWatch Log Group to recive log entries, defaults to ${CLOUDWATCH_LOG_GROUP}', log_group_env)
  .option('-s, --log-stream [string]', 'CloudWatch Log Stream to recive log entries, defaults to ${CLOUDWATCH_LOG_STREAM}', log_stream_env)
  .option('-d, --decode', 'Decode the row data from Base64')
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

var file_name = path.basename(program.file);
var full_file_path = path.join(folder, file_name );

// Delete the file if it already exists
if (fs.existsSync(full_file_path)) {
  fs.unlinkSync(full_file_path);
}

// Copy the file from S3
var s3 = new AWS.S3();
var s3_params = {Bucket: program.bucket, Key: program.file};
var file = fs.createWriteStream(full_file_path);

s3.getObject(s3_params).on('httpData', function(chunk) {
  file.write(chunk);
}).on('httpDone', function() {
  logger.log(program.logStream, "File downloaded, restoring to DynamoDB");
  file.end();



  // Read the CSV file and write to DynamoDB
  var stream = fs.createReadStream(full_file_path);
  var counter = 0;
  var request = 0;
  var csvStream = csv()
      .on("data", function(data){
        item = JSON.parse(data);
        if (program.decode === true) {
          item = JSON.parse(new Buffer(data, 'base64').to_string('utf8'));
        }
        logger.log(program.logStream, 'Record: ' + counter);
        logger.log(program.logStream, item);
        request = request + 1;

        var saved = when.promise(function(resolve, reject, notify){
          dynamodb.putItem( {
            Item: item,
            TableName: program.table
          }, function(err, data){
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
        });
        Fiber(function() {
          while(saved.inspect().state === 'pending') {
            sleep(1000);
          }
          saved.done(function(data){
            logger.log(program.logStream, "Saved");
          }, function(err){
            logger.log(program.logStream, err);
            exit(1);
          });
        }).run();

        counter = counter + 1;

      })
      .on("end", function(){
        logger.log(program.logStream, "Restore to DynamoDB complete");
        exit(0);
      });

      stream.pipe(csvStream);
}).send();

function saveItem(db, item, counter, callback) {
  logger.log(program.logStream, db, item, counter);
    logger.log(program.logStream, 'Writing item ' + counter);
    db.putItem({
      Item: item,
      TableName: program.table
    }, function(err, response){
      logger.log(program.logStream, 'Item written ' + counter);
      resolve('done');
    });

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
