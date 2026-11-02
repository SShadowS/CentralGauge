codeunit 87280 "HX091 Dispatch Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('01');
        HX091Init();
        Spy.HX091FailExport(ContractNo, 1);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 0, 'Run 1');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 1: the failed entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 1: the failed entry has Error set');
        Assert.AreEqual(Spy.HX091ExportErrText(ContractNo), Entry."Error Message", 'Run 1: Error Message holds the export error');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: Retry Count is 1');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 2');
        Assert.IsFalse(HX091Stored(EntryNo), 'Run 2: the delivered entry is removed');

        EntryNo := HX091Queue(ContractNo);
        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 2, 2, 'Resend after the recovered delivery');
        Assert.IsFalse(HX091Stored(EntryNo), 'Resend: the entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario02()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('02');
        HX091Init();
        Spy.HX091FailAfter(ContractNo, 1);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 1');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 1: the failed entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 1: the failed entry has Error set');
        Assert.AreEqual(Spy.HX091AfterErrText(ContractNo), Entry."Error Message", 'Run 1: Error Message holds the later step''s error');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: Retry Count is 1');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 2');
        Assert.IsFalse(HX091Stored(EntryNo), 'Run 2: the completed entry is removed');

        EntryNo := HX091Queue(ContractNo);
        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 2, 2, 'Resend after the recovered delivery');
        Assert.IsFalse(HX091Stored(EntryNo), 'Resend: the entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario03()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryA: Integer;
        EntryB: Integer;
    begin
        ContractNo := HX091Contract('03');
        HX091Init();
        Spy.HX091FailExport(ContractNo, 1);
        BindSubscription(Spy);
        EntryA := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 0, 'Run 1');
        Assert.IsTrue(Entry.Get(EntryA), 'Run 1: the failed entry A stays queued');
        Assert.IsTrue(Entry.Error, 'Run 1: entry A has Error set');

        // The desk deletes the failed entry and queues the same invoice again.
        Entry.Delete();
        Commit();
        EntryB := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 2 under entry B');
        Assert.IsFalse(HX091Stored(EntryB), 'Run 2: entry B is removed');
        Assert.IsFalse(HX091Stored(EntryA), 'Entry A stays deleted');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario04()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('04');
        HX091Init();
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'First delivery');
        Assert.IsFalse(HX091Stored(EntryNo), 'First delivery: the entry is removed');

        EntryNo := HX091Queue(ContractNo);
        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 2, 2, 'Deliberate resend');
        Assert.IsFalse(HX091Stored(EntryNo), 'Deliberate resend: the entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario05()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('05');
        HX091Init();
        Spy.HX091FailExport(ContractNo, 2);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 1: the failed entry stays queued');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: Retry Count is 1');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 0, 'Run 2');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 2: the failed entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 2: the entry has Error set');
        Assert.AreEqual(Spy.HX091ExportErrText(ContractNo), Entry."Error Message", 'Run 2: Error Message holds the export error');
        Assert.AreEqual(2, Entry."Retry Count", 'Run 2: Retry Count is 2 after two failed attempts');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 3');
        Assert.IsFalse(HX091Stored(EntryNo), 'Run 3: the delivered entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario06()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('06');
        HX091Init();
        Spy.HX091Probe(ContractNo);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        Assert.IsTrue(Spy.HX091ProbeSeen(), 'The mail step ran');
        Assert.IsTrue(Spy.HX091ProbeFound(), 'The entry is in the queue while its mail is sent');
        Assert.IsFalse(Spy.HX091ProbeError(), 'An entry that has never failed is not shown with Error');
        Assert.AreEqual(0, Spy.HX091ProbeRetry(), 'An entry that has never failed has Retry Count 0');
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Clean run');
        Assert.IsFalse(HX091Stored(EntryNo), 'The delivered entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario07()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        FirstNo: Code[20];
        SecondNo: Code[20];
        FirstEntry: Integer;
        SecondEntry: Integer;
    begin
        FirstNo := HX091Contract('07A');
        SecondNo := HX091Contract('07B');
        HX091Init();
        Spy.HX091FailExport(FirstNo, 1);
        BindSubscription(Spy);
        FirstEntry := HX091Queue(FirstNo);
        SecondEntry := HX091Queue(SecondNo);

        HX091Process();
        HX091AssertDelivered(Spy, SecondNo, 1, 1, 'Run 1, second invoice');
        Assert.IsFalse(HX091Stored(SecondEntry), 'Run 1: the second entry is removed');
        HX091AssertDelivered(Spy, FirstNo, 1, 0, 'Run 1, first invoice');
        Assert.IsTrue(Entry.Get(FirstEntry), 'Run 1: the first entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 1: the first entry has Error set');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: the first entry has Retry Count 1');

        HX091Process();
        HX091AssertDelivered(Spy, FirstNo, 1, 1, 'Run 2, first invoice');
        Assert.IsFalse(HX091Stored(FirstEntry), 'Run 2: the first entry is removed');
        HX091AssertDelivered(Spy, SecondNo, 1, 1, 'Run 2, second invoice');

        UnbindSubscription(Spy);
        HX091Cleanup(FirstNo);
        HX091Cleanup(SecondNo);
    end;

    [Test]
    procedure Scenario08()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('08');
        HX091Init();
        Spy.HX091FailMail(ContractNo, 1);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 0, 0, 'Run 1');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 1: the failed entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 1: the failed entry has Error set');
        Assert.AreEqual(Spy.HX091MailErrText(ContractNo), Entry."Error Message", 'Run 1: Error Message holds the mail error');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: Retry Count is 1');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 2');
        Assert.IsFalse(HX091Stored(EntryNo), 'Run 2: the delivered entry is removed');

        EntryNo := HX091Queue(ContractNo);
        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 2, 2, 'Resend after the recovered delivery');
        Assert.IsFalse(HX091Stored(EntryNo), 'Resend: the entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario10()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Entry: Record "CGR Invoice Dispatch Entry";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('10');
        HX091Init();
        Spy.HX091FailMail(ContractNo, 1);
        Spy.HX091FailExport(ContractNo, 1);
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 0, 0, 'Run 1');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 1: the failed entry stays queued');
        Assert.AreEqual(Spy.HX091MailErrText(ContractNo), Entry."Error Message", 'Run 1: Error Message holds the mail error');
        Assert.AreEqual(1, Entry."Retry Count", 'Run 1: Retry Count is 1');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 0, 'Run 2');
        Assert.IsTrue(Entry.Get(EntryNo), 'Run 2: the failed entry stays queued');
        Assert.IsTrue(Entry.Error, 'Run 2: the entry has Error set');
        Assert.AreEqual(Spy.HX091ExportErrText(ContractNo), Entry."Error Message", 'Run 2: Error Message holds the latest error');
        Assert.AreEqual(2, Entry."Retry Count", 'Run 2: Retry Count is 2');

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Run 3');
        Assert.IsFalse(HX091Stored(EntryNo), 'Run 3: the delivered entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    [Test]
    procedure Scenario09()
    var
        Spy: Codeunit "HX091 Delivery Spy";
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        ContractNo := HX091Contract('09');
        HX091Init();
        BindSubscription(Spy);
        EntryNo := HX091Queue(ContractNo);

        HX091Process();
        HX091AssertDelivered(Spy, ContractNo, 1, 1, 'Clean run');
        Assert.IsFalse(HX091Stored(EntryNo), 'The delivered entry is removed');

        UnbindSubscription(Spy);
        HX091Cleanup(ContractNo);
    end;

    local procedure HX091Init()
    var
        Entry: Record "CGR Invoice Dispatch Entry";
        MailLog: Record "CGR Invoice Mail Log";
        ExportLog: Record "CGR Invoice Export Log";
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.Reset();
        Entry.DeleteAll();
        MailLog.DeleteAll();
        ExportLog.DeleteAll();
        Commit();
    end;

    // ProcessQueue must complete: an error escaping it (not a failed delivery, which the queue records) fails the scenario.
    local procedure HX091Process()
    var
        Ok: Boolean;
    begin
        Commit();
        ClearLastError();
        Ok := Codeunit.Run(Codeunit::"HX091 Queue Runner");
        Assert.IsTrue(Ok, 'ProcessQueue completes without an error: ' + GetLastErrorText());
    end;

    // A fresh contract number per test run, so delivery memory left in the database by an earlier run cannot leak in.
    local procedure HX091Contract(Tag: Text): Code[20]
    begin
        exit(CopyStr('H91' + Tag + '-' + DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20));
    end;

    local procedure HX091Queue(ContractNo: Code[20]): Integer
    var
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
        Entry: Record "CGR Invoice Dispatch Entry";
        EntryNo: Integer;
    begin
        EntryNo := Dispatcher.QueueInvoice(ContractNo);
        Commit();
        Entry.SetRange("Contract No.", ContractNo);
        Entry.SetCurrentKey("Entry No.");
        Entry.FindLast();
        Assert.AreEqual(Entry."Entry No.", EntryNo, 'QueueInvoice returns the number of the entry it queued');
        exit(Entry."Entry No.");
    end;

    local procedure HX091Stored(EntryNo: Integer): Boolean
    var
        Entry: Record "CGR Invoice Dispatch Entry";
    begin
        exit(Entry.Get(EntryNo));
    end;

    local procedure HX091AssertDelivered(var Spy: Codeunit "HX091 Delivery Spy"; ContractNo: Code[20]; MailCount: Integer; ExportCount: Integer; Step: Text)
    var
        MailLog: Record "CGR Invoice Mail Log";
        ExportLog: Record "CGR Invoice Export Log";
    begin
        Assert.AreEqual(MailCount, Spy.HX091Mails(ContractNo), Step + ': invoice mails sent for ' + ContractNo);
        Assert.AreEqual(ExportCount, Spy.HX091Exports(ContractNo), Step + ': invoice exports written for ' + ContractNo);
        MailLog.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(MailCount, MailLog.Count(), Step + ': mail log rows for ' + ContractNo);
        ExportLog.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(ExportCount, ExportLog.Count(), Step + ': export log rows for ' + ContractNo);
    end;

    local procedure HX091Cleanup(ContractNo: Code[20])
    var
        Entry: Record "CGR Invoice Dispatch Entry";
        MailLog: Record "CGR Invoice Mail Log";
        ExportLog: Record "CGR Invoice Export Log";
    begin
        Entry.SetRange("Contract No.", ContractNo);
        Entry.DeleteAll();
        MailLog.SetRange("Contract No.", ContractNo);
        MailLog.DeleteAll();
        ExportLog.SetRange("Contract No.", ContractNo);
        ExportLog.DeleteAll();
        Commit();
    end;
}
