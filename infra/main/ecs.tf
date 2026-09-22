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
  # score and publish run the train image with the score role, which may write predictions and the parameter
  tasks = {
    prepare = { cpu = 2048, memory = 8192, role = aws_iam_role.job["prepare"].arn, log = "prepare", image = "prepare" }
    train   = { cpu = 4096, memory = 16384, role = aws_iam_role.job["train"].arn, log = "train", image = "train" }
    score   = { cpu = 2048, memory = 8192, role = aws_iam_role.job["score"].arn, log = "train", image = "train" }
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
    image       = "${local.image}-${each.value.image}"
    essential   = true
    command     = [each.key]
    environment = local.job_env
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
