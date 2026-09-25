// SPIKE (throwaway): harness bench M4-16 premise probes
// P1-P4 report measured values via Error('RESULTS-...') so the SOAP failure text carries them verbatim.
// P5 tests fail on purpose, one per failure shape, to capture the harness message text.
codeunit 50250 "M16P Probes"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure P1DeleteAllThenErrorInCallee()
    var
        Row: Record "M16P Row";
        Ops: Codeunit "M16P Ops";
        Before: Integer;
    begin
        SeedRows();
        Before := Row.Count();
        asserterror Ops.DeleteAllThenError();
        Error('RESULTS-P1a before=%1 after=%2 lastError=%3', Before, Row.Count(), GetLastErrorText());
    end;

    [Test]
    procedure P1DeleteAllThenErrorInline()
    var
        Row: Record "M16P Row";
        Before: Integer;
    begin
        SeedRows();
        Before := Row.Count();
        asserterror begin
            Row.DeleteAll();
            Error('P1b raised after DeleteAll');
        end;
        Error('RESULTS-P1b before=%1 after=%2', Before, Row.Count());
    end;

    [Test]
    procedure P2CalcDate()
    begin
        Error('RESULTS-P2 plus0M=%1 plus1M_2027=%2 plus1M_2028=%3 dwy=%4',
            Format(CalcDate('<+0M>', 20270131D), 0, 9),
            Format(CalcDate('<+1M>', 20270131D), 0, 9),
            Format(CalcDate('<+1M>', 20280131D), 0, 9),
            Date2DWY(20270306D, 1));
    end;

    [Test]
    procedure P3Json()
    var
        Obj: JsonObject;
        Back: JsonObject;
        Tok: JsonToken;
        IntVal: JsonValue;
        BoolVal: JsonValue;
        IntText: Text;
        BoolText: Text;
        ObjText: Text;
        BackText: Text;
        Tricky: Text;
    begin
        IntVal.SetValue(1450);
        IntVal.WriteTo(IntText);
        BoolVal.SetValue(false);
        BoolVal.WriteTo(BoolText);
        Tricky := 'say "hej" til å';
        Obj.Add('zeta', 1);
        Obj.Add('alpha', 'two');
        Obj.Add('mid', true);
        Obj.Add('tricky', Tricky);
        Obj.WriteTo(ObjText);
        Back.ReadFrom(ObjText);
        Back.Get('tricky', Tok);
        Back.WriteTo(BackText);
        Error('RESULTS-P3 int=[%1] bool=[%2] obj=[%3] roundtripEqual=%4 roundtripText=[%5] reWritten=[%6]',
            IntText, BoolText, ObjText, Tok.AsValue().AsText() = Tricky, Tok.AsValue().AsText(), BackText);
    end;

    [Test]
    procedure P4AutoIncrementAfterInsert()
    var
        E1: Record "M16P Entry";
        E2: Record "M16P Entry";
    begin
        E1.Init();
        E1.Description := 'first';
        E1.Insert(true);
        E2.Init();
        E2.Description := 'second';
        E2.Insert(false);
        Error('RESULTS-P4 afterInsertTrue=%1 afterInsertFalse=%2', E1."Entry No.", E2."Entry No.");
    end;

    [Test]
    procedure P5aAssertAreEqualFails()
    begin
        Assert.AreEqual(1, 2, 'P5a probe message');
    end;

    [Test]
    procedure P5bExpectedErrorMismatch()
    begin
        asserterror Error('P5b actual error text');
        Assert.ExpectedError('P5b expected error text');
    end;

    [Test]
    procedure P5cAssertErrorNoError()
    var
        X: Integer;
    begin
        asserterror X := 1;
    end;

    [Test]
    procedure P5dRuntimeError()
    begin
        Error('P5d runtime error text');
    end;

    local procedure SeedRows()
    var
        Row: Record "M16P Row";
        I: Integer;
    begin
        Row.DeleteAll();
        for I := 1 to 3 do begin
            Row.Init();
            Row."No." := StrSubstNo('ROW%1', I);
            Row.Insert();
        end;
    end;
}
