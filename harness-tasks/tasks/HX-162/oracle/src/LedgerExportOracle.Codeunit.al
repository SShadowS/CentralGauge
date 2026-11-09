codeunit 88390 "HX162 Ledger Export Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure LineGroupedAmountPadded()
    var
        LedgerExport: Codeunit "CGR Ledger Export";
        EntryNo: Integer;
    begin
        InitHX162();
        EntryNo := InsertEntryHX162('HX162-C1', 'HX162-V1', 20270301D, 1234.5, 1500);

        Assert.AreEqual('HX162-C1;HX162-V1;2027-03-01;1234.50;1500', LedgerExport.BuildLine(EntryNo), 'No thousands separator and always two decimals');
    end;

    [Test]
    procedure LineHalfAmountPadded()
    var
        LedgerExport: Codeunit "CGR Ledger Export";
        EntryNo: Integer;
    begin
        InitHX162();
        EntryNo := InsertEntryHX162('HX162-C2', 'HX162-V2', 20270301D, 103.5, 200);

        Assert.AreEqual('HX162-C2;HX162-V2;2027-03-01;103.50;200', LedgerExport.BuildLine(EntryNo), 'One decimal is padded to two');
    end;

    [Test]
    procedure LineRoundsToCents()
    var
        LedgerExport: Codeunit "CGR Ledger Export";
        EntryNo: Integer;
    begin
        InitHX162();
        EntryNo := InsertEntryHX162('HX162-C3', 'HX162-V3', 20270301D, 12.345, 300);

        Assert.AreEqual('HX162-C3;HX162-V3;2027-03-01;12.35;300', LedgerExport.BuildLine(EntryNo), 'The amount is rounded to cents');
    end;

    [Test]
    procedure LineNegativeCorrection()
    var
        LedgerExport: Codeunit "CGR Ledger Export";
        EntryNo: Integer;
    begin
        InitHX162();
        EntryNo := InsertEntryHX162('HX162-C4', 'HX162-V4', 20270301D, -45.5, 400);

        Assert.AreEqual('HX162-C4;HX162-V4;2027-03-01;-45.50;400', LedgerExport.BuildLine(EntryNo), 'A correction has a leading minus and two decimals');
    end;

    [Test]
    procedure LineLateDateTwoDigitMonth()
    var
        LedgerExport: Codeunit "CGR Ledger Export";
        EntryNo: Integer;
    begin
        InitHX162();
        EntryNo := InsertEntryHX162('HX162-C5', 'HX162-V5', 20271115D, 12.35, 7);

        Assert.AreEqual('HX162-C5;HX162-V5;2027-11-15;12.35;7', LedgerExport.BuildLine(EntryNo), 'Date as yyyy-mm-dd, km as a whole number');
    end;

    [Test]
    procedure FileTwoEntriesInOrder()
    var
        Entry: Record "CGR Rental Ledger Entry";
        LedgerExport: Codeunit "CGR Ledger Export";
        Lines: List of [Text];
    begin
        InitHX162();
        InsertEntryHX162('HX162-C6', 'HX162-V6', 20270301D, 103.5, 1500);
        InsertEntryHX162('HX162-C6', 'HX162-V7', 20270302D, 12.35, 20);

        Entry.SetRange("Contract No.", 'HX162-C6');
        Lines := NonEmptyLinesHX162(LedgerExport.BuildFile(Entry));

        Assert.AreEqual(2, Lines.Count(), 'One line per ledger entry');
        Assert.AreEqual('HX162-C6;HX162-V6;2027-03-01;103.50;1500', Lines.Get(1), 'First line is the first entry');
        Assert.AreEqual('HX162-C6;HX162-V7;2027-03-02;12.35;20', Lines.Get(2), 'Second line is the second entry');
    end;

    local procedure InitHX162()
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        WorkDate(20270301D);
        Entry.SetFilter("Contract No.", 'HX162-*');
        Entry.DeleteAll();
    end;

    local procedure InsertEntryHX162(ContractNo: Code[20]; VehicleNo: Code[20]; PostingDate: Date; Amount: Decimal; KmDriven: Integer): Integer
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        Entry.Init();
        Entry."Contract No." := ContractNo;
        Entry."Vehicle No." := VehicleNo;
        Entry."Posting Date" := PostingDate;
        Entry.Amount := Amount;
        Entry."Km Driven" := KmDriven;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;

    local procedure NonEmptyLinesHX162(Body: Text) Lines: List of [Text]
    var
        Part: Text;
        Cr: Text[1];
        Lf: Text[1];
    begin
        Cr[1] := 13;
        Lf[1] := 10;
        foreach Part in DelChr(Body, '=', Cr).Split(Lf) do
            if Part.Trim() <> '' then
                Lines.Add(Part.Trim());
    end;
}
