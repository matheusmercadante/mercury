// The branch a task branch was cut from, when it was not main, is written in
// the repository's own config under the task branch. Git drops the whole
// `branch.<name>` section when the branch is deleted, so the record lives
// exactly as long as the branch does.
import { nameSlug } from '../shared/product-name.mjs';

/** The git config key holding the local branch a task branch started from. */
export const startKey = (branch: string): string => `branch.${branch}.${nameSlug}-base`;
