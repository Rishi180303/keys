resource "aws_s3_bucket" "data" { bucket = local.data_b }
resource "aws_s3_bucket" "artifacts" { bucket = local.art_b }

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each                = { data = aws_s3_bucket.data.id, artifacts = aws_s3_bucket.artifacts.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket     = aws_s3_bucket.artifacts.id
  depends_on = [aws_s3_bucket_versioning.artifacts]
  rule {
    id     = "expire-old-runs"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

resource "aws_ecr_repository" "keys" {
  name                 = "keys"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "keys" {
  repository = aws_ecr_repository.keys.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last ten images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ssm_parameter" "active_model" {
  name  = "/keys/active-model"
  type  = "String"
  value = "none"
  lifecycle { ignore_changes = [value] }
}
