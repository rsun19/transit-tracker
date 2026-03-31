import { runCommand } from './_gate-utils.mjs';

runCommand('npm', ['run', 'test:a11y', '--prefix', 'frontend'], 'accessibility');
