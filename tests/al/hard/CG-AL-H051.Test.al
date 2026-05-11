codeunit 80266 "CG-AL-H051 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestRespectsCallerFilter()
    var
        Sample: Record "CG H051 Sample";
        Tagger: Codeunit "CG H051 Tagger";
        Codes: List of [Code[20]];
        Cnt: Integer;
    begin
        Sample.SetRange("Group", 'G1');
        Codes.Add('A');
        Codes.Add('C');
        Codes.Add('E');
        Cnt := Tagger.CountTagged(Sample, Codes);
        Assert.AreEqual(1, Cnt, 'Of A/C/E only A is in caller-filtered G1.');
    end;

    [Test]
    procedure TestCallerFilterPreserved()
    var
        Sample: Record "CG H051 Sample";
        Tagger: Codeunit "CG H051 Tagger";
        Codes: List of [Code[20]];
    begin
        Sample.SetRange("Group", 'G1');
        Codes.Add('A');
        Codes.Add('B');
        Tagger.CountTagged(Sample, Codes);
        Assert.AreEqual('G1', Sample.GetFilter("Group"), 'Caller filter on Group must survive.');
    end;

    [Test]
    procedure TestUnknownCodesSkipped()
    var
        Sample: Record "CG H051 Sample";
        Tagger: Codeunit "CG H051 Tagger";
        Codes: List of [Code[20]];
        Cnt: Integer;
    begin
        Codes.Add('X');
        Codes.Add('Y');
        Codes.Add('A');
        Cnt := Tagger.CountTagged(Sample, Codes);
        Assert.AreEqual(1, Cnt, 'Only A exists; X and Y are skipped silently.');
    end;

    [Test]
    procedure TestEmptyCodesYieldsZero()
    var
        Sample: Record "CG H051 Sample";
        Tagger: Codeunit "CG H051 Tagger";
        Codes: List of [Code[20]];
        Cnt: Integer;
    begin
        Cnt := Tagger.CountTagged(Sample, Codes);
        Assert.AreEqual(0, Cnt, 'No codes -> no marks -> zero.');
    end;
}
