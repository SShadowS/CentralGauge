codeunit 80032 "CG-AL-M032 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestBlankRowAOverwrittenByInstall()
    var
        Dest: Record "CG DT Destination";
    begin
        Assert.IsTrue(Dest.Get('A'), 'Prereq install should have seeded destination row A');
        Assert.AreEqual('val-a', Dest."New Value", 'Blank destination row A should be overwritten by the install-time DataTransfer with source value');
    end;

    [Test]
    procedure TestPresetRowBPreservedByInstall()
    var
        Dest: Record "CG DT Destination";
    begin
        Assert.IsTrue(Dest.Get('B'), 'Prereq install should have seeded destination row B');
        Assert.AreEqual('preset-b', Dest."New Value", 'Pre-populated destination row B should be unchanged by AddDestinationFilter');
    end;

    [Test]
    procedure TestBlankRowCOverwrittenByInstall()
    var
        Dest: Record "CG DT Destination";
    begin
        Assert.IsTrue(Dest.Get('C'), 'Prereq install should have seeded destination row C');
        Assert.AreEqual('val-c', Dest."New Value", 'Blank destination row C should be overwritten by the install-time DataTransfer with source value');
    end;
}
