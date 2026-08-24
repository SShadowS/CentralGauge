codeunit 89296 "CG-AL-X102 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure AddRow(var Buffer: Record "CG X102 Working Row" temporary; EntryNo: Integer; RowDescription: Text[50]; RowAmount: Decimal)
    begin
        Buffer.Init();
        Buffer."Entry No." := EntryNo;
        Buffer.Description := RowDescription;
        Buffer.Amount := RowAmount;
        Buffer.Insert();
    end;

    [Test]
    procedure SnapshotHoldsEveryRowThatExistedWhenTaken()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 1, 'First', 111);
        AddRow(Source, 2, 'Second', 222);

        BufferSvc.TakeSnapshot(Source, Snapshot);

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must hold every row that existed at the moment it was taken');
        Assert.IsTrue(Snapshot.Get(1), 'The snapshot must contain the row with entry number 1');
        Assert.AreEqual('First', Snapshot.Description, 'The snapshot row must carry the source row''s description');
        Assert.AreEqual(111, Snapshot.Amount, 'The snapshot row must carry the source row''s amount');
        Assert.IsTrue(Snapshot.Get(2), 'The snapshot must contain the row with entry number 2');
        Assert.AreEqual(222, Snapshot.Amount, 'The snapshot row must carry the source row''s amount');
    end;

    [Test]
    procedure SnapshotIgnoresARowAddedToTheSourceAfterwards()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 1, 'First', 111);
        AddRow(Source, 2, 'Second', 222);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        AddRow(Source, 3, 'Late', 333);

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must keep the row count it had at the moment it was taken');
        Assert.IsFalse(Snapshot.Get(3), 'A row added to the source after the snapshot was taken must not appear in the snapshot');
    end;

    [Test]
    procedure SnapshotKeepsTheAmountARowHadWhenTaken()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 10, 'Rate', 500);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Get(10);
        Source.Amount := 900;
        Source.Modify();

        Assert.IsTrue(Snapshot.Get(10), 'The snapshot must contain the row with entry number 10');
        Assert.AreEqual(500, Snapshot.Amount, 'The snapshot must keep the amount the row had when it was taken, not a later change made to the source');
    end;

    [Test]
    procedure SnapshotKeepsARowThatIsLaterRemovedFromTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 20, 'Keep', 40);
        AddRow(Source, 21, 'Doomed', 80);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Get(21);
        Source.Delete();

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must keep both rows it was taken with, even after one is later removed from the source');
        Assert.IsTrue(Snapshot.Get(21), 'A row removed from the source after the snapshot was taken must still exist in the snapshot');
        Assert.AreEqual(80, Snapshot.Amount, 'The removed row must keep the amount it had when the snapshot was taken');
    end;

    [Test]
    procedure TakingASnapshotDoesNotDisturbTheSourceRows()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 1, 'First', 10);
        AddRow(Source, 2, 'Middle', 20);
        AddRow(Source, 3, 'Last', 30);

        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Reset();
        Assert.AreEqual(3, Source.Count(), 'Every source row must still be there after taking a snapshot');
        Assert.IsTrue(Source.Get(2), 'The source row with entry number 2 must survive taking a snapshot');
        Assert.AreEqual(20, Source.Amount, 'The source row amounts must be untouched by taking a snapshot');
    end;

    [Test]
    procedure SharedViewSeesARowAddedToTheSourceAfterAttaching()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 1, 'Seed', 10);
        BufferSvc.AttachSharedView(Source, SharedView);

        AddRow(Source, 2, 'Late', 55);

        SharedView.Reset();
        Assert.AreEqual(2, SharedView.Count(), 'The shared view must see a row added to the source after attaching');
        Assert.IsTrue(SharedView.Get(2), 'The shared view must reach a row added to the source after attaching');
        Assert.AreEqual(55, SharedView.Amount, 'The shared view must read the added row''s amount');
    end;

    [Test]
    procedure SharedViewReflectsAChangeMadeThroughTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 30, 'Status', 15);
        BufferSvc.AttachSharedView(Source, SharedView);

        Source.Get(30);
        Source.Amount := 77;
        Source.Modify();

        Assert.IsTrue(SharedView.Get(30), 'The shared view must reach the row the source holds');
        Assert.AreEqual(77, SharedView.Amount, 'The shared view must read the amount the source row was changed to after attaching');
    end;

    [Test]
    procedure AWriteMadeThroughTheSharedViewReachesTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        AddRow(Source, 40, 'Target', 5);
        BufferSvc.AttachSharedView(Source, SharedView);

        Assert.IsTrue(SharedView.Get(40), 'The shared view must reach the row the source holds');
        SharedView.Amount := 99;
        SharedView.Modify();

        Source.Get(40);
        Assert.AreEqual(99, Source.Amount, 'A change written through the shared view must be visible in the source');
    end;
}
