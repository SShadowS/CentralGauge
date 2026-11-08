codeunit 80549 "CGR Redelivery Due Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DueOnlyNeverAttempted()
    var
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
    begin
        HX147DueOnlyPrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-DN1');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, HX147DueOnlyBase()), 'A never attempted entry is due');
    end;

    [Test]
    procedure DueOnlyThirtySecondsAfterStoredAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        Stamp: DateTime;
    begin
        HX147DueOnlyPrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-DB1');
        Entry.Get(EntryNo);
        Entry.Attempts := 1;
        Entry."Last Attempt At" := HX147DueOnlyBase();
        Entry.Modify();

        Entry.Get(EntryNo);
        Stamp := Entry."Last Attempt At";
        Assert.IsTrue(Redelivery.IsDue(EntryNo, Stamp + 30000), 'Due 30 seconds after the last attempt');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, Stamp + 10000), 'Not due 10 seconds after the last attempt');
    end;

    [Test]
    procedure DueOnlySentAndFailedAreNotDue()
    var
        Entry: Record "CGR Outbox Entry";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        SentNo: Integer;
        FailedNo: Integer;
    begin
        HX147DueOnlyPrepare();
        SentNo := Lib.QueueOutboxEntry('HX147-DS1');
        FailedNo := Lib.QueueOutboxEntry('HX147-DS2');
        Entry.Get(SentNo);
        Entry.Sent := true;
        Entry.Modify();
        Entry.Get(FailedNo);
        Entry.Failed := true;
        Entry.Modify();

        Assert.IsFalse(Redelivery.IsDue(SentNo, HX147DueOnlyBase()), 'A sent entry is not due');
        Assert.IsFalse(Redelivery.IsDue(FailedNo, HX147DueOnlyBase()), 'A failed entry is not due');
    end;

    local procedure HX147DueOnlyPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240315D);
        Entry.DeleteAll();
        Commit();
    end;

    local procedure HX147DueOnlyBase(): DateTime
    begin
        exit(CreateDateTime(20240301D, 100000T));
    end;
}
