# infra/backup/replication.tf
# S3 cross-region replication for LLMtxt backup off-platform redundancy.
#
# Copies all backup objects from the primary bucket (us-east-1) to a
# DR replica bucket in a different region (us-west-2).
#
# Prerequisites:
#   1. Both buckets must already exist with versioning enabled.
#      (S3 replication requires bucket versioning.)
#   2. IAM role with s3:ReplicateObject permission on destination.
#   3. Run: terraform init && terraform apply
#
# R2 NOTE: Cloudflare R2 cross-region replication uses the R2 Replication UI
# (Cloudflare Dashboard > R2 > Bucket > Replication) — not Terraform.
# See replication-r2-note.md for R2-specific instructions.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "primary_bucket" {
  description = "Primary backup bucket name (source)"
  type        = string
  default     = "llmtxt-backups"
}

variable "dr_bucket" {
  description = "DR replica bucket name (destination, different region)"
  type        = string
  default     = "llmtxt-backups-dr"
}

variable "primary_region" {
  description = "Primary bucket AWS region"
  type        = string
  default     = "us-east-1"
}

variable "dr_region" {
  description = "DR replica bucket AWS region (must differ from primary)"
  type        = string
  default     = "us-west-2"
}

provider "aws" {
  alias  = "primary"
  region = var.primary_region
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
}

# ---- IAM role for S3 replication ----

data "aws_iam_policy_document" "replication_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  provider           = aws.primary
  name               = "llmtxt-backup-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
}

data "aws_iam_policy_document" "replication_policy" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.primary_bucket}"]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging"
    ]
    resources = ["arn:aws:s3:::${var.primary_bucket}/*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:ReplicateObject",
      "s3:ReplicateDelete",
      "s3:ReplicateTags"
    ]
    resources = ["arn:aws:s3:::${var.dr_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.primary
  role     = aws_iam_role.replication.id
  policy   = data.aws_iam_policy_document.replication_policy.json
}

# ---- Enable versioning on primary bucket (required for replication) ----

resource "aws_s3_bucket_versioning" "primary" {
  provider = aws.primary
  bucket   = var.primary_bucket
  versioning_configuration {
    status = "Enabled"
  }
}

# ---- Enable versioning on DR bucket (required as replication target) ----

resource "aws_s3_bucket_versioning" "dr" {
  provider = aws.dr
  bucket   = var.dr_bucket
  versioning_configuration {
    status = "Enabled"
  }
}

# ---- Replication configuration on primary bucket ----

resource "aws_s3_bucket_replication_configuration" "backup_replication" {
  provider = aws.primary
  depends_on = [aws_s3_bucket_versioning.primary]

  bucket = var.primary_bucket
  role   = aws_iam_role.replication.arn

  rule {
    id     = "replicate-all-backups"
    status = "Enabled"

    destination {
      bucket        = "arn:aws:s3:::${var.dr_bucket}"
      storage_class = "STANDARD_IA"
    }
  }
}

output "replication_role_arn" {
  description = "ARN of the IAM replication role"
  value       = aws_iam_role.replication.arn
}
