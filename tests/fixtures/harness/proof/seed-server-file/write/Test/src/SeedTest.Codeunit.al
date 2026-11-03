codeunit 79650 "CG Proof Seed Write Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    // A file is outside the test's database transaction: it persists past
    // the test and the cleanup. L4 must detect it.
    [Test]
    procedure Seed()
    var
        Marker: File;
        Name: Text;
    begin
        Name := TemporaryPath() + 'cg-proof-seed.txt';
        Marker.TextMode(true);
        Marker.Create(Name);
        Marker.Write('cg-proof-seed');
        Marker.Close();
        Assert.IsTrue(File.Exists(Name), 'the marker file was written');
    end;
}
