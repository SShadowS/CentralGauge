This is a harness probe, not a benchmark run. Before working on the task, do these steps in order:
1. Start the library-function-finder agent in the background with the task statement as its prompt.
2. Run the Explore agent once in the foreground to list the app folders under C:\workspace.
3. If the background agent is still running, stop it with TaskStop.
4. Run the al-reviewer agent once in the foreground on the workspace.
Then solve the task in C:\task\prompt.md. Build and test with `cg-al compile` and `cg-al test`.
