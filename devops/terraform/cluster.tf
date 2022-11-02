module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "18.15.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version
  cluster_ip_family = "ipv4"
  cluster_endpoint_private_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = concat(module.vpc.private_subnets, module.vpc.public_subnets)

  iam_role_arn = var.cluster_iam_role_arn

  create_cloudwatch_log_group = false
  cloudwatch_log_group_kms_key_id = aws_kms_key.log_group_key.arn

  cluster_tags = {
    Environment = var.app_env
    Terraform = true
  }

  eks_managed_node_group_defaults = {
    vpc_id     = module.vpc.vpc_id
    min_size     = 2
    max_size     = 4
    desired_size = 2
    disk_size    = 200

    instance_types = [var.cluster_instance_types]
    capacity_type  = var.cluster_capacity_type

    launch_template_name = "${var.app_name}-launch-template"
  }

  eks_managed_node_groups = [
    {
      name       = "${var.app_name}-ng1"
      subnet_ids = module.vpc.private_subnets
    }
  ]
}


resource "aws_iam_role_policy_attachment" "node-group-1" {
  role       = module.eks.eks_managed_node_groups[0].iam_role_name
  policy_arn = var.ebs_policy_arn
}

data "aws_eks_cluster" "cluster" {
  name = module.eks.cluster_id
}

data "aws_eks_cluster_auth" "cluster" {
  name = module.eks.cluster_id
}
