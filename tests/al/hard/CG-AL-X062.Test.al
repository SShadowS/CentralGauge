codeunit 88815 "CG-AL-X062 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure AuditOnlyCountsAuditEvents()
    var
        Publisher: Codeunit "CG X062 Publisher";
        Listener: Codeunit "CG X062 Listener";
    begin
        Listener.ListenToAuditOnly();
        BindSubscription(Listener);
        Publisher.Run(1);
        UnbindSubscription(Listener);

        Assert.AreEqual(1, Listener.AuditCount(), 'OnAudit must be counted');
        Assert.AreEqual(0, Listener.NotifyCount(), 'OnNotify must NOT be counted after ListenToAuditOnly');
    end;

    [Test]
    procedure BothCountsBothEvents()
    var
        Publisher: Codeunit "CG X062 Publisher";
        Listener: Codeunit "CG X062 Listener";
    begin
        Listener.ListenToBoth();
        BindSubscription(Listener);
        Publisher.Run(1);
        UnbindSubscription(Listener);

        Assert.AreEqual(1, Listener.AuditCount(), 'OnAudit must be counted');
        Assert.AreEqual(1, Listener.NotifyCount(), 'OnNotify must be counted after ListenToBoth');
    end;

    [Test]
    procedure RepeatedRunsAccumulate()
    var
        Publisher: Codeunit "CG X062 Publisher";
        Listener: Codeunit "CG X062 Listener";
    begin
        Listener.ListenToAuditOnly();
        BindSubscription(Listener);
        Publisher.Run(1);
        Publisher.Run(2);
        Publisher.Run(3);
        UnbindSubscription(Listener);

        Assert.AreEqual(3, Listener.AuditCount(), 'Three runs must count three audits');
        Assert.AreEqual(0, Listener.NotifyCount(), 'Three runs must count no notifies');
    end;

    [Test]
    procedure AListenerToldNothingCountsNothing()
    var
        Publisher: Codeunit "CG X062 Publisher";
        Listener: Codeunit "CG X062 Listener";
    begin
        BindSubscription(Listener);
        Publisher.Run(1);
        UnbindSubscription(Listener);

        Assert.AreEqual(0, Listener.AuditCount(), 'Nothing was chosen, so nothing is counted');
        Assert.AreEqual(0, Listener.NotifyCount(), 'Nothing was chosen, so nothing is counted');
    end;
}
