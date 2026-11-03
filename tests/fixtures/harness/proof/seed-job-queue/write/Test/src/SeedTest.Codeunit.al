codeunit 84962 "CG Proof Seed Write Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Seed()
    var
        Probe: Codeunit "CG Proof Seed Probe";
    begin
        Assert.IsTrue(Probe.Seeded(), 'the install codeunit seeded the state');
    end;
}
