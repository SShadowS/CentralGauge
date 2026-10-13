# Task 7573: Automated tests for the session context

Reported by the Platform team.

A desk user chose her branch for the session. An administrator then refreshed the setup, and from that moment new rental contracts at her desk were created under the setup's default branch instead of the branch she had chosen.

Before anyone changes the session context we want automated tests that pin down how `CGR Session Context` must behave. Put them in a new test codeunit in the Test app. Do not fix the session context in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Session Context`, procedures `GetSetup(var Setup: Record "CGR Setup")`, `RefreshSetup()`, `CurrentBranch(): Code[10]`, `SetCurrentBranch(NewBranchCode: Code[10])` and `Reset()`):

- There is one state per session, shared by every variable of the codeunit.
- GetSetup loads CGR Setup on its first call; when there is no CGR Setup record it loads an initialised, empty setup. Until RefreshSetup or Reset it returns that same loaded setup, even when CGR Setup is changed or created meanwhile.
- After RefreshSetup, the next GetSetup loads CGR Setup again, as it is at that moment.
- CurrentBranch returns the branch set with SetCurrentBranch, whatever that branch is, including an empty branch or one equal to the setup's default branch. When no branch has been set, it returns the "Default Branch Code" of the loaded setup.
- RefreshSetup keeps a branch set with SetCurrentBranch.
- Reset clears the set branch and the loaded setup.
