# infra/backup/lifecycle.tf
# S3 bucket lifecycle rules for LLMtxt backup retention tiers.
#
# Retention policy:
#   /daily/   — 7 days
#   /weekly/  — 30 days
#   /monthly/ — 365 days
#
# Prerequisites:
#   - terraform init (downloads aws provider)
#   - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in env
#   - The bucket must already exist (create manually or add aws_s3_bucket resource)
#
# Apply:
#   cd infra/backup
#   terraform init
#   terraform plan -var="bucket_name=llmtxt-backups"
#   terraform apply -var="bucket_name=llmtxt-backups"
#
# NOTE for Cloudflare R2:
#   R2 does not support the S3 Lifecycle API as of 2026-04.
#   Use lifecycle-r2-manual.sh instead (manual AWS CLI delete loop).
#   Terraform apply with AWS_ENDPOINT_URL pointing at R2 will fail on
#   PutBucketLifecycleConfiguration — this is a known R2 limitation.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "bucket_name" {
  description = "Primary backup bucket name (e.g. llmtxt-backups)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for the bucket"
  type        = string
  default     = "us-east-1"
}

provider "aws" {
  region = var.aws_region
  # Credentials from env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
}

resource "aws_s3_bucket_lifecycle_configuration" "backup_retention" {
  bucket = var.bucket_name

  rule {
    id     = "daily-7d-retention"
    status = "Enabled"

    filter {
      prefix = "daily/"
    }

    expiration {
      days = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "weekly-30d-retention"
    status = "Enabled"

    filter {
      prefix = "weekly/"
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "monthly-365d-retention"
    status = "Enabled"

    filter {
      prefix = "monthly/"
    }

    expiration {
      days = 365
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}
