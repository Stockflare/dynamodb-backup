# DynamoDB Backup

A Node.js Javascript command line utility that will back up a DynamoDB table to a file in a S3 bucket.

Javascript's async nature is used to maximize the throughput that a single threaded process can achieve while scanning a DynamoDB table and writing to a text file.

The script will retry all Scan operations that fail with provisioned throughput errors and the project https://github.com/Stockflare/worker-dynamic-dynamodb is relied upon to to automatically scale the provisioned throughput of the table being saved.

## Usage
```
Usage: dynamodb-backup [options]

Options:

  -h, --help                 output usage information
  -V, --version              output the version number
  -t, --table [string]       DynamoDB Table to backup, defaults to ${TABLE_NAME}
  -b, --bucket [string]      Bucket to upload backup file to, defaults to  ${BACKUP_FILE_BUCKET}
  -l, --log-group [string]   CloudWatch Log Group to receive log entries, defaults to ${CLOUDWATCH_LOG_GROUP}
  -s, --log-stream [string]  CloudWatch Log Stream to receive log entries, defaults to ${CLOUDWATCH_LOG_STREAM}
  -r, --region               Region for AWS API calls, defaults to ${AWS_REGION}

```
The script will log to console if `CLOUDWATCH_LOG_GROUP` and `CLOUDWATCH_LOG_STREAM` are not provided.

You will notice that all important parameters are defaulted from Environment variables.  This is to allow for easy launching from the Amazon AWS ECS Container Service console.

## Backup strategy
The backup is intended solely for the purpose of restoring data to an identically structured DynamoDB table.

* The DynamoDB table is scanned and the Item hash is retrieved for every record, an example is below:
```
{"updated_at"=>{"N"=>"1447203612"}, "id"=>{"S"=>"bnpkOnVzZA==\n"}, "rate"=>{"N"=>"0.6550358501120767"}}
```
* The item is JSON.stringify'd
* The item is Base64 encoded if the --encode option has been used
* the item is saved to csv file.  

The CSV file has no headers and only has a single column (the item).

The CSV file is saved locally and uploaded to the S3 bucket as:

```<table_name>/<table_name>_<time_stamp>.csv```

## Cloudformation
The provided cloudformation will create the S3 bucket and deploy a ECS Container Service Task Definition that can be used to schedule automated backups with https://github.com/Stockflare/lambda-scheduler
