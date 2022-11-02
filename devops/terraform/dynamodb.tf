resource "aws_dynamodb_table" "defillama-nft-table" {
  name           = var.dynamodb_table_name
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "PK"
  range_key      = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "category"
    type = "S"
  }

  attribute {
    name = "totalVolumeUSD"
    type = "N"
  }

  attribute {
    name = "marketplace"
    type = "S"
  }

  attribute {
    name = "contractAddress"
    type = "S"
  }

  global_secondary_index {
    name               = "collectionsIndex"
    hash_key           = "category"
    range_key          = "totalVolumeUSD"
    projection_type    = "INCLUDE"
    non_key_attributes = [
      "address",
      "name",
      "logo",
      "totalVolume",
      "totalVolumeUSD",
      "dailyVolume",
      "dailyVolumeUSD",
      "floor",
      "floorUSD",
      "owners",
      "chains",
      "marketplaces",
      "lastBlock",
      "deployBlock",
      "deployTxnHash"
    ]
  }

  global_secondary_index {
    name               = "marketSaleIndex"
    hash_key           = "marketplace"
    range_key          = "contractAddress"
    projection_type    = "INCLUDE"
    non_key_attributes = [
      "buyerAddress",
      "chain",
      "metadata",
      "paymentTokenAddress",
      "price",
      "priceBase",
      "priceUSD",
      "sellerAddress"
    ]
  }

  stream_enabled = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = {
    Name        = var.dynamodb_table_name
    Environment = "production"
    Terraform   = true
  }
}

resource "aws_dynamodb_table" "defillama-nft-table-test" {
  name           = var.dynamodb_table_name_test
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "PK"
  range_key      = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "category"
    type = "S"
  }

  attribute {
    name = "totalVolumeUSD"
    type = "N"
  }

  attribute {
    name = "recordState"
    type = "N"
  }

  global_secondary_index {
    name               = "collectionsIndex"
    hash_key           = "category"
    range_key          = "totalVolumeUSD"
    projection_type    = "INCLUDE"  
    non_key_attributes = [  
      "address",
      "name",
      "logo",
      "totalVolume",
      "totalVolumeUSD",
      "dailyVolume",
      "dailyVolumeUSD",
      "floor",
      "floorUSD",
      "owners",
      "chains",
      "marketplaces",
      "lastBlock",
      "deployBlock",
      "deployTxnHash"
    ]
  }

  global_secondary_index {
    name               = "saleStateIndex"
    hash_key           = "recordState"
    range_key          = "SK"
    projection_type    = "ALL"
  }

  stream_enabled = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = {
    Name        = var.dynamodb_table_name_test
    Environment = "production"
    Terraform   = true
  }
}