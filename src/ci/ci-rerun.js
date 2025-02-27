#!/usr/bin/env node

const { default: chalk } = require('chalk');
const { program } = require('commander');
const got = require('got');

const { archOption, ArchTypes, BuildTypes, getCIType } = require('./common');
const { fatal } = require('../utils/logging');
const { CIRCLE_TOKEN, APPVEYOR_CLOUD_TOKEN } = process.env;

const APPVEYOR_ACCOUNT_NAME = 'electron-bot';

const rerunCircleCIWorkflow = async (id, options) => {
  const jobs = options.jobs ? options.jobs.split(',') : [];

  // See https://circleci.com/docs/api/v2/#operation/rerunWorkflow.
  if (options.enableSsh) {
    if (options.fromFailed) {
      throw new commander.InvalidArgumentError(
        '--enable-ssh and --from-failed are mutually exclusive',
      );
    } else if (jobs.length === 0) {
      throw new commander.InvalidArgumentError('--enable-ssh requires --jobs');
    }
  } else if (options.fromFailed && jobs.length) {
    throw new commander.InvalidArgumentError('--enable-ssh and --jobs are mutually exclusive');
  }

  const { pipeline_number } = await got(`https://circleci.com/api/v2/workflow/${id}`, {
    username: CIRCLE_TOKEN,
    password: '',
  }).json();

  const { workflow_id } = await got
    .post(`https://circleci.com/api/v2/workflow/${id}/rerun`, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      username: CIRCLE_TOKEN,
      password: '',
      json: {
        enable_ssh: options.enableSsh,
        from_failed: options.fromFailed,
        jobs,
        sparse_tree: false,
      },
    })
    .json();

  console.log(`${chalk.bgMagenta(chalk.white('New Workflow Run'))}

⦿ ${chalk.white(
    `https://app.circleci.com/pipelines/github/electron/electron/${pipeline_number}/workflows/${workflow_id}`,
  )}
  `);
};

const rerunAppveyorBuild = async (id, options) => {
  const data = await got
    .put(`https://ci.appveyor.com/api/builds`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${APPVEYOR_CLOUD_TOKEN}`,
      },
      json: {
        buildId: id,
        reRunIncomplete: options.fromFailed,
      },
    })
    .json();
  console.log(`${chalk.bgMagenta(chalk.white('Build Rerun'))}

⦿ ${chalk.white(
    `https://ci.appveyor.com/project/${APPVEYOR_ACCOUNT_NAME}/${ArchTypes[options.arch]}/builds/${
      data.buildId
    }`,
  )}
  `);
};

program
  .description('Rerun CI workflows')
  .argument('<id>', 'The ID of the workflow or build to rerun')
  .option('-j|--jobs', 'Comma-separated list of job IDs to rerun (CircleCI only)')
  .option('-f, --from-failed', 'Rerun workflow from failed/incomplete', true)
  .option('-s, --enable-ssh', 'Rerun the workflow with ssh enabled (CircleCI only)', false)
  .addOption(archOption)
  .action(async (id, options) => {
    try {
      const type = getCIType(id);

      if (type === BuildTypes.CIRCLECI) {
        if (!CIRCLE_TOKEN) {
          fatal('process.env.CIRCLE_TOKEN required for AppVeyor cancellations');
        }

        await rerunCircleCIWorkflow(id, options);
      } else if (type === BuildTypes.APPVEYOR) {
        if (!options.arch) {
          throw new commander.InvalidArgumentError('arch is required for Appveyor reruns');
        } else if (!APPVEYOR_CLOUD_TOKEN) {
          fatal('process.env.APPVEYOR_CLOUD_TOKEN required for AppVeyor reruns');
        }

        await rerunAppveyorBuild(id, options);
      }
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
