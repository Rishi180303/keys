output "data_bucket" { value = aws_s3_bucket.data.bucket }
output "artifacts_bucket" { value = aws_s3_bucket.artifacts.bucket }
output "ecr_repository" { value = aws_ecr_repository.keys.repository_url }
output "cluster" { value = aws_ecs_cluster.keys.name }
output "api_url" { value = "${aws_apigatewayv2_api.keys.api_endpoint}/predict" }
