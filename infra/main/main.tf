terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "keys-tfstate-266380778582"
    key          = "main.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
}

variable "region" { default = "us-east-1" }
variable "image_tag" { description = "git sha the images are tagged with" }
variable "alarm_email" {
  description = "where alarm emails go, set in the gitignored terraform.tfvars"
  type        = string
  sensitive   = true
  validation {
    condition     = strcontains(var.alarm_email, "@")
    error_message = "alarm_email must be an email address: set it in terraform.tfvars, or TF_VAR_alarm_email in CI."
  }
}

data "aws_caller_identity" "me" {}
data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone-id"
    values = ["use1-az1", "use1-az2", "use1-az4", "use1-az5", "use1-az6"]
  }
}

locals {
  account = data.aws_caller_identity.me.account_id
  data_b  = "keys-data-${local.account}"
  art_b   = "keys-artifacts-${local.account}"
  image   = "${aws_ecr_repository.keys.repository_url}:${var.image_tag}"
  job_env = [
    { name = "KEYS_DATA_BUCKET", value = local.data_b },
    { name = "KEYS_ARTIFACTS_BUCKET", value = local.art_b },
  ]
}
