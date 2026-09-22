locals {
  network = {
    AwsvpcConfiguration = {
      Subnets        = data.aws_subnets.default.ids
      SecurityGroups = [aws_security_group.jobs.id]
      AssignPublicIp = "ENABLED"
    }
  }
  common_env = [
    { Name = "KEYS_RUN", "Value.$" = "$.run" },
    { Name = "KEYS_WEEKS", "Value.$" = "$.weeks" },
  ]
}

resource "aws_sfn_state_machine" "pipeline" {
  name     = "keys-pipeline"
  role_arn = aws_iam_role.states.arn
  definition = jsonencode({
    Comment = "prepare, train five folds, score, publish"
    StartAt = "Prepare"
    TimeoutSeconds = 43200
    States = {
      Prepare = {
        Type       = "Task"
        Resource   = "arn:aws:states:::ecs:runTask.sync"
        ResultPath = null
        Parameters = {
          LaunchType           = "FARGATE"
          Cluster              = aws_ecs_cluster.keys.arn
          TaskDefinition       = aws_ecs_task_definition.job["prepare"].arn
          NetworkConfiguration = local.network
          Overrides            = { ContainerOverrides = [{ Name = "job", Environment = local.common_env }] }
        }
        Next = "Train"
      }
      Train = {
        Type           = "Map"
        ItemsPath      = "$.folds"
        MaxConcurrency = 5
        ResultPath     = null
        ItemSelector = {
          "fold.$"   = "$$.Map.Item.Value"
          "run.$"    = "$.run"
          "weeks.$"  = "$.weeks"
          "epochs.$" = "$.epochs"
        }
        ItemProcessor = {
          ProcessorConfig = { Mode = "INLINE" }
          StartAt         = "TrainFold"
          States = {
            TrainFold = {
              Type     = "Task"
              Resource = "arn:aws:states:::ecs:runTask.sync"
              End      = true
              Parameters = {
                LaunchType           = "FARGATE"
                Cluster              = aws_ecs_cluster.keys.arn
                TaskDefinition       = aws_ecs_task_definition.job["train"].arn
                NetworkConfiguration = local.network
                Overrides = {
                  ContainerOverrides = [{
                    Name = "job"
                    Environment = concat(local.common_env, [
                      { Name = "KEYS_FOLD", "Value.$" = "States.Format('{}', $.fold)" },
                      { Name = "KEYS_EPOCHS", "Value.$" = "States.Format('{}', $.epochs)" },
                    ])
                  }]
                }
              }
            }
          }
        }
        Next = "Score"
      }
      Score = {
        Type       = "Task"
        Resource   = "arn:aws:states:::ecs:runTask.sync"
        ResultPath = null
        Parameters = {
          LaunchType           = "FARGATE"
          Cluster              = aws_ecs_cluster.keys.arn
          TaskDefinition       = aws_ecs_task_definition.job["score"].arn
          NetworkConfiguration = local.network
          Overrides            = { ContainerOverrides = [{ Name = "job", Command = ["score"], Environment = local.common_env }] }
        }
        Next = "Publish"
      }
      Publish = {
        Type       = "Task"
        Resource   = "arn:aws:states:::ecs:runTask.sync"
        ResultPath = null
        Parameters = {
          LaunchType           = "FARGATE"
          Cluster              = aws_ecs_cluster.keys.arn
          TaskDefinition       = aws_ecs_task_definition.job["score"].arn
          NetworkConfiguration = local.network
          Overrides            = { ContainerOverrides = [{ Name = "job", Command = ["publish"], Environment = local.common_env }] }
        }
        End = true
      }
    }
  })
}

output "state_machine" { value = aws_sfn_state_machine.pipeline.arn }
