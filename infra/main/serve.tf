# the prediction api: http api -> lambda (serve image) -> model named by the ssm parameter
resource "aws_cloudwatch_log_group" "predict" {
  name              = "/keys/predict"
  retention_in_days = 30
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "predict" {
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.active_model.arn]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/models/*"]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.predict.arn}:*"]
  }
}

resource "aws_iam_role" "predict" {
  name               = "keys-predict"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "predict" {
  role   = aws_iam_role.predict.id
  policy = data.aws_iam_policy_document.predict.json
}

# lets lambda pull the serve image from this account's repository
data "aws_iam_policy_document" "ecr_lambda" {
  statement {
    sid     = "LambdaECRImageRetrievalPolicy"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "aws:sourceArn"
      values   = ["arn:aws:lambda:${var.region}:${local.account}:function:*"]
    }
  }
}

resource "aws_ecr_repository_policy" "keys" {
  repository = aws_ecr_repository.keys.name
  policy     = data.aws_iam_policy_document.ecr_lambda.json
}

# no reserved concurrency: the account allows 10 concurrent executions and lambda keeps all 10 unreserved
resource "aws_lambda_function" "predict" {
  function_name = "keys-predict"
  role          = aws_iam_role.predict.arn
  package_type  = "Image"
  image_uri     = "${local.image}-serve"
  architectures = ["x86_64"]
  memory_size   = 2048
  timeout       = 30
  environment {
    variables = { KEYS_ARTIFACTS_BUCKET = local.art_b }
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.predict.name
  }
  depends_on = [aws_iam_role_policy.predict, aws_ecr_repository_policy.keys]
}

resource "aws_apigatewayv2_api" "keys" {
  name          = "keys-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
  }
}

resource "aws_apigatewayv2_integration" "predict" {
  api_id                 = aws_apigatewayv2_api.keys.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.predict.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "predict" {
  api_id    = aws_apigatewayv2_api.keys.id
  route_key = "POST /predict"
  target    = "integrations/${aws_apigatewayv2_integration.predict.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.keys.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "keys-api"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.predict.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.keys.execution_arn}/*/*/predict"
}

# a direct ping every five minutes keeps one environment and lambda's copy of the 3 GB image warm. with a cold
# image cache the first requests after a deploy took 25 to 35 seconds to start, past the api's 30 second limit
resource "aws_cloudwatch_event_rule" "warm" {
  name                = "keys-predict-warm"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "warm" {
  rule  = aws_cloudwatch_event_rule.warm.name
  arn   = aws_lambda_function.predict.arn
  input = jsonencode({ warm = true })
}

resource "aws_lambda_permission" "warm" {
  statement_id  = "keys-predict-warm"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.predict.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.warm.arn
}

resource "aws_sns_topic" "alarms" { name = "keys-alarms" }

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# the handler turns its own failures into 500 replies, which lambda does not count as errors,
# so the alarm watches what callers see: any 5xx from the api, timeouts and crashes included
resource "aws_cloudwatch_metric_alarm" "predict_errors" {
  alarm_name          = "keys-predict-errors"
  alarm_description   = "keys-api answered with a server error in the last five minutes"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.keys.id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_dashboard" "keys" {
  dashboard_name = "keys"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title   = "api requests", region = var.region, stat = "Sum", period = 300
          metrics = [["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.keys.id]]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title = "api latency, ms", region = var.region, period = 300
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.keys.id, { stat = "p50" }],
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.keys.id, { stat = "p90" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title = "api errors", region = var.region, stat = "Sum", period = 300
          metrics = [
            ["AWS/ApiGateway", "4xx", "ApiId", aws_apigatewayv2_api.keys.id],
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.keys.id],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title = "pipeline executions per day", region = var.region, stat = "Sum", period = 86400
          metrics = [
            for m in ["ExecutionsStarted", "ExecutionsSucceeded", "ExecutionsFailed", "ExecutionsTimedOut"] :
            ["AWS/States", m, "StateMachineArn", aws_sfn_state_machine.pipeline.arn]
          ]
        }
      },
    ]
  })
}
