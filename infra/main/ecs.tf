resource "aws_ecs_cluster" "keys" { name = "keys" }

resource "aws_cloudwatch_log_group" "jobs" {
  for_each          = toset(["prepare", "train"])
  name              = "/keys/${each.key}"
  retention_in_days = 30
}

resource "aws_security_group" "jobs" {
  name        = "keys-jobs"
  description = "egress only, for fargate tasks"
  vpc_id      = data.aws_vpc.default.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

locals {
  # every job runs the train image and the command picks the stage; score and publish share the score role
  tasks = {
    prepare = { cpu = 2048, memory = 8192, role = aws_iam_role.job["prepare"].arn, log = "prepare", env = [] }
    train   = { cpu = 4096, memory = 16384, role = aws_iam_role.job["train"].arn, log = "train", env = [] }
    score   = { cpu = 2048, memory = 8192, role = aws_iam_role.job["score"].arn, log = "train", env = [] }
    rate = {
      cpu = 2048, memory = 8192, role = aws_iam_role.job["rate"].arn, log = "train"
      env = [
        { name = "KEYS_SITE_BUCKET", value = local.site_b },
        { name = "KEYS_API_URL", value = "${aws_apigatewayv2_api.keys.api_endpoint}/predict" },
      ]
    }
  }
}

resource "aws_ecs_task_definition" "job" {
  for_each                 = local.tasks
  family                   = "keys-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.task_exec.arn
  task_role_arn            = each.value.role
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name        = "job"
    image       = "${local.image}-train"
    essential   = true
    command     = [each.key]
    environment = concat(local.job_env, each.value.env)
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.jobs[each.value.log].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = each.key
      }
    }
  }])
}
