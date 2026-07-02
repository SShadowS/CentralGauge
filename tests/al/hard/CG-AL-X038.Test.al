codeunit 80327 "CG-AL-X038 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Task: Record "CG X038 Task";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion (or runtime error) before it reaches
        // ClearState() at the end. Nothing in this task's flow ever calls
        // Commit() (neither the Dispatcher nor a correct Scheduler needs
        // one), so everything runs under the default per-test
        // TestIsolation = Codeunit rollback -- wipe-then-reseed is enough.
        Task.DeleteAll();
    end;

    local procedure SeedScenarioA()
    var
        Task: Record "CG X038 Task";
    begin
        ClearState();

        // Two twin pairs (G-A: 1/3, G-B: 2/5) plus one singleton (G-C: 4).
        // Ascending Priority order is 2(10), 3(20), 5(30), 1(40), 4(50) --
        // deliberately NOT the same order as ascending Entry No. (1..5), so
        // a dispatcher that iterates in the wrong order deletes the WRONG
        // twin and lands on a different survivor set than the correct one.
        Task.Init();
        Task."Entry No." := 1;
        Task.Priority := 40;
        Task."Group Code" := 'G-A';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 2;
        Task.Priority := 10;
        Task."Group Code" := 'G-B';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 3;
        Task.Priority := 20;
        Task."Group Code" := 'G-A';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 4;
        Task.Priority := 50;
        Task."Group Code" := 'G-C';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 5;
        Task.Priority := 30;
        Task."Group Code" := 'G-B';
        Task.Insert();
    end;

    local procedure SeedScenarioB()
    var
        Task: Record "CG X038 Task";
    begin
        ClearState();

        // One twin pair (G-X: 10/12) plus two singletons (G-Y: 11, G-Z: 13),
        // different Entry No./Priority/Group values than Scenario A to block
        // hardcoding. Ascending Priority order is 13(10), 11(30), 12(60),
        // 10(90) -- again not the ascending Entry No. order.
        Task.Init();
        Task."Entry No." := 10;
        Task.Priority := 90;
        Task."Group Code" := 'G-X';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 11;
        Task.Priority := 30;
        Task."Group Code" := 'G-Y';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 12;
        Task.Priority := 60;
        Task."Group Code" := 'G-X';
        Task.Insert();

        Task.Init();
        Task."Entry No." := 13;
        Task.Priority := 10;
        Task."Group Code" := 'G-Z';
        Task.Insert();
    end;

    [Test]
    procedure ScenarioASurvivorsDispatchedExactlyOnceInPriorityOrder()
    var
        Task: Record "CG X038 Task";
        Scheduler: Codeunit "CG X038 Scheduler";
    begin
        // [GIVEN] two twin pairs + one singleton, priority order != entry-no order
        SeedScenarioA();

        // [WHEN] the queue is run
        Scheduler.RunQueue();

        // [THEN] dispatching in ascending Priority order (2, 3, 5, 1, 4)
        // means task 2 is dispatched first and deletes its twin, task 5;
        // task 3 is dispatched next and deletes ITS twin, task 1; task 5 and
        // task 1 are no longer present by the time their own turn comes, so
        // they must never be (re)dispatched; task 4 has no twin.
        //
        // Survivors: 2, 3, 4 -- each dispatched exactly once (Runs = 1), with
        // the dispatcher's own opaque computed Value and re-keyed Priority as
        // proof the dispatch genuinely happened (never derivable by a caller
        // that fakes the outcome instead of really calling Dispatch).
        Assert.IsTrue(Task.Get(2), 'Task 2 must survive (it dispatched before its twin, task 5)');
        Assert.AreEqual(1, Task.Runs, 'Task 2 must be dispatched exactly once');
        Assert.AreEqual(28, Task.Value, 'Task 2 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1010, Task.Priority, 'Task 2 must carry the dispatcher''s re-keyed Priority');

        Assert.IsTrue(Task.Get(3), 'Task 3 must survive (it dispatched before its twin, task 1)');
        Assert.AreEqual(1, Task.Runs, 'Task 3 must be dispatched exactly once');
        Assert.AreEqual(39, Task.Value, 'Task 3 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1020, Task.Priority, 'Task 3 must carry the dispatcher''s re-keyed Priority');

        Assert.IsTrue(Task.Get(4), 'Task 4 must survive (it has no twin)');
        Assert.AreEqual(1, Task.Runs, 'Task 4 must be dispatched exactly once');
        Assert.AreEqual(50, Task.Value, 'Task 4 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1050, Task.Priority, 'Task 4 must carry the dispatcher''s re-keyed Priority');

        Assert.IsFalse(Task.Get(1), 'Task 1 must be gone: deleted as task 3''s twin before its own turn');
        Assert.IsFalse(Task.Get(5), 'Task 5 must be gone: deleted as task 2''s twin before its own turn');

        Task.Reset();
        Assert.AreEqual(3, Task.Count(), 'Exactly the three survivors may remain');

        ClearState();
    end;

    [Test]
    procedure ScenarioBSurvivorsDispatchedExactlyOnceInPriorityOrder()
    var
        Task: Record "CG X038 Task";
        Scheduler: Codeunit "CG X038 Scheduler";
    begin
        // [GIVEN] a differently-shaped queue: one twin pair + two singletons
        SeedScenarioB();

        // [WHEN] the queue is run
        Scheduler.RunQueue();

        // [THEN] dispatching in ascending Priority order (13, 11, 12, 10)
        // means task 12 is dispatched before its twin, task 10, so task 12
        // survives and task 10 is gone before its own turn comes.
        Assert.IsTrue(Task.Get(13), 'Task 13 must survive (it has no twin)');
        Assert.AreEqual(1, Task.Runs, 'Task 13 must be dispatched exactly once');
        Assert.AreEqual(149, Task.Value, 'Task 13 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1010, Task.Priority, 'Task 13 must carry the dispatcher''s re-keyed Priority');

        Assert.IsTrue(Task.Get(11), 'Task 11 must survive (it has no twin)');
        Assert.AreEqual(1, Task.Runs, 'Task 11 must be dispatched exactly once');
        Assert.AreEqual(127, Task.Value, 'Task 11 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1030, Task.Priority, 'Task 11 must carry the dispatcher''s re-keyed Priority');

        Assert.IsTrue(Task.Get(12), 'Task 12 must survive (it dispatched before its twin, task 10)');
        Assert.AreEqual(1, Task.Runs, 'Task 12 must be dispatched exactly once');
        Assert.AreEqual(138, Task.Value, 'Task 12 must carry the dispatcher''s own computed Value');
        Assert.AreEqual(1060, Task.Priority, 'Task 12 must carry the dispatcher''s re-keyed Priority');

        Assert.IsFalse(Task.Get(10), 'Task 10 must be gone: deleted as task 12''s twin before its own turn');

        Task.Reset();
        Assert.AreEqual(3, Task.Count(), 'Exactly the three survivors may remain');

        ClearState();
    end;
}
