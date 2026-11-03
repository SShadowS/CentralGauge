codeunit 79651 "CG Proof Seed Read Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Gone()
    var
        Probe: Codeunit "CG Proof Seed Probe";
    begin
        Assert.IsFalse(Probe.Seeded(), 'the seeded state is still there');
    end;
}
