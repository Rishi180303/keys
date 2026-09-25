data "aws_iam_policy_document" "ecs_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "states_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_exec" {
  name               = "keys-task-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
}

resource "aws_iam_role_policy_attachment" "task_exec" {
  role       = aws_iam_role.task_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

locals {
  # each job role: what it may read and where it may write, by bucket arn and prefix
  job_roles = {
    prepare = { read = ["${aws_s3_bucket.data.arn}/raw/*"], write = ["${aws_s3_bucket.data.arn}/processed/*"], list = [aws_s3_bucket.data.arn] }
    train   = { read = ["${aws_s3_bucket.data.arn}/processed/*"], write = ["${aws_s3_bucket.artifacts.arn}/models/*"], list = [aws_s3_bucket.data.arn] }
    score = {
      read  = ["${aws_s3_bucket.data.arn}/processed/*", "${aws_s3_bucket.artifacts.arn}/models/*"]
      write = ["${aws_s3_bucket.artifacts.arn}/predictions/*", "${aws_s3_bucket.artifacts.arn}/summary/*"]
      list  = [aws_s3_bucket.data.arn, aws_s3_bucket.artifacts.arn]
    }
    rate = {
      read = [
        "${aws_s3_bucket.data.arn}/raw/supplementary_data.csv", "${aws_s3_bucket.data.arn}/processed/*",
        "${aws_s3_bucket.artifacts.arn}/predictions/*", "${aws_s3_bucket.artifacts.arn}/summary/*",
      ]
      write = ["${aws_s3_bucket.artifacts.arn}/ratings/*", "${aws_s3_bucket.site.arn}/data/*"]
      list  = [aws_s3_bucket.data.arn, aws_s3_bucket.artifacts.arn, aws_s3_bucket.site.arn]
    }
  }
}

data "aws_iam_policy_document" "job" {
  for_each = local.job_roles
  statement {
    actions   = ["s3:GetObject"]
    resources = each.value.read
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = each.value.write
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = each.value.list
  }
  dynamic "statement" {
    for_each = each.key == "score" ? [1] : []
    content {
      actions   = ["ssm:PutParameter"]
      resources = [aws_ssm_parameter.active_model.arn]
    }
  }
}

resource "aws_iam_role" "job" {
  for_each           = local.job_roles
  name               = "keys-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
}

resource "aws_iam_role_policy" "job" {
  for_each = local.job_roles
  role     = aws_iam_role.job[each.key].id
  policy   = data.aws_iam_policy_document.job[each.key].json
}

data "aws_iam_policy_document" "states" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [for k in keys(local.job_roles) : "arn:aws:ecs:${var.region}:${local.account}:task-definition/keys-${k}:*"]
  }
  statement {
    actions   = ["ecs:StopTask", "ecs:DescribeTasks"]
    resources = ["*"]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = concat([aws_iam_role.task_exec.arn], [for r in aws_iam_role.job : r.arn])
  }
  statement {
    actions   = ["events:PutTargets", "events:PutRule", "events:DescribeRule"]
    resources = ["arn:aws:events:${var.region}:${local.account}:rule/StepFunctionsGetEventsForECSTaskRule"]
  }
}

resource "aws_iam_role" "states" {
  name               = "keys-states"
  assume_role_policy = data.aws_iam_policy_document.states_trust.json
}

resource "aws_iam_role_policy" "states" {
  role   = aws_iam_role.states.id
  policy = data.aws_iam_policy_document.states.json
}
