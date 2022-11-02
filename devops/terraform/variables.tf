# AWS Config
variable "region" {
  default     = "us-west-2"
  description = "AWS region"
}

variable profile {
  default = "default"
  description = "AWS Profile"
}

# DynamoDB
variable "dynamodb_table_name" {}
variable "dynamodb_table_name_test" {}

# NFT Server Cluster
variable app_name {}
variable app_env {}
variable cluster_name {}
variable cluster_version {}
variable cluster_instance_types {}
variable cluster_capacity_type {}
variable cluster_iam_role_arn {}
variable ebs_policy_arn {}
variable ng1_name {}
variable ng1_role_arn {}
variable oidc_arn {}
variable oidc_condition_key {}