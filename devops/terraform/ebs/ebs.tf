terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.8.0"
    }
  }
}

provider "aws" {
  profile = var.profile
  region = var.region
}

resource "aws_iam_role" "AmazonEKSEBSCSIRole" {
  name = "AmazonEKSEBSCSIRole"

  managed_policy_arns = [var.ebs_policy_arn]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"
        Principal = {
          Federated = var.oidc_arn
        }
        Condition = {
          StringEquals = zipmap([var.oidc_condition_key], [["sts.amazonaws.com"]])
        }
      }
    ]
  })

  tags = {
    Terraform = true
  }
}
