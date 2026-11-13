codeunit 88465 "HX167 Owner File Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure OwnerFileMatchesTodayBytes()
    var
        Expected: List of [Integer];
        ContractA: Code[20];
        ContractB: Code[20];
    begin
        StartHX167('HX167-ASC');
        ContractA := NewContractHX167('HX167-ASC', 'Jensen Transport');
        ContractB := NewContractHX167('HX167-ASC', 'Nordic Car Pool');
        AddEntryHX167('HX167-ASC', ContractA, 20250110D, 125.5);
        AddEntryHX167('HX167-ASC', ContractB, 20250105D, 300);
        AddEntryHX167('HX167-ASC', ContractA, 20250120D, -40.25);

        AddLineHX167(Expected, 'Contract;Customer;Posting Date;Amount');
        AddLineHX167(Expected, ContractB + ';Nordic Car Pool;' + Format(20250105D, 0, 9) + ';' + Format(300, 0, 9));
        AddLineHX167(Expected, ContractA + ';Jensen Transport;' + Format(20250110D, 0, 9) + ';' + Format(125.5, 0, 9));
        AddLineHX167(Expected, ContractA + ';Jensen Transport;' + Format(20250120D, 0, 9) + ';' + Format(-40.25, 0, 9));

        Assert.AreEqual(ByteListTextHX167(Expected), ByteListTextHX167(FileBytesHX167('HX167-ASC', 20250101D, 20250131D)),
          'The owner file holds the same bytes as the text built today, line ends included');
    end;

    [Test]
    procedure DanishCustomerNameIsUtf8()
    var
        Expected: List of [Integer];
        ContractNo: Code[20];
    begin
        StartHX167('HX167-DAN');
        ContractNo := NewContractHX167('HX167-DAN', 'Kærgård Ølhøj');
        AddEntryHX167('HX167-DAN', ContractNo, 20250114D, 75);

        AddLineHX167(Expected, 'Contract;Customer;Posting Date;Amount');
        AddLineHX167(Expected, ContractNo + ';Kærgård Ølhøj;' + Format(20250114D, 0, 9) + ';' + Format(75, 0, 9));

        Assert.AreEqual(ByteListTextHX167(Expected), ByteListTextHX167(FileBytesHX167('HX167-DAN', 20250101D, 20250131D)),
          'A customer name with æ, ø and å arrives intact for an owner who reads the file as UTF-8');
    end;

    [Test]
    procedure EmptyPeriodHasHeaderOnly()
    var
        Expected: List of [Integer];
        ContractNo: Code[20];
    begin
        StartHX167('HX167-EMP');
        ContractNo := NewContractHX167('HX167-EMP', 'Quiet Customer');
        AddEntryHX167('HX167-EMP', ContractNo, 20241231D, 10);

        AddLineHX167(Expected, 'Contract;Customer;Posting Date;Amount');

        Assert.AreEqual(ByteListTextHX167(Expected), ByteListTextHX167(FileBytesHX167('HX167-EMP', 20250101D, 20250131D)),
          'A period without entries gives the header line only, as today');
    end;

    [Test]
    procedure OnlyPeriodEntriesOfTheVehicleAreListed()
    var
        ContractNo: Code[20];
        OtherContractNo: Code[20];
        FileText: Text;
    begin
        StartHX167('HX167-PER');
        StartHX167('HX167-OTH');
        ContractNo := NewContractHX167('HX167-PER', 'Fleet Partner');
        OtherContractNo := NewContractHX167('HX167-OTH', 'Other Partner');
        AddEntryHX167('HX167-PER', ContractNo, 20250131D, 22.22);
        AddEntryHX167('HX167-PER', ContractNo, 20250101D, 11.11);
        AddEntryHX167('HX167-PER', ContractNo, 20241231D, 33.33);
        AddEntryHX167('HX167-PER', ContractNo, 20250201D, 44.44);
        AddEntryHX167('HX167-OTH', OtherContractNo, 20250115D, 55.55);

        FileText := AsciiTextHX167(FileBytesHX167('HX167-PER', 20250101D, 20250131D));

        Assert.IsTrue(StrPos(FileText, 'Contract;Customer;Posting Date;Amount') = 1, 'The file starts with the header line');
        Assert.IsTrue(StrPos(FileText, ';11.11') > 0, 'The entry on the first day of the period is listed');
        Assert.IsTrue(StrPos(FileText, ';22.22') > 0, 'The entry on the last day of the period is listed');
        Assert.IsTrue(StrPos(FileText, ';11.11') < StrPos(FileText, ';22.22'), 'Entries are listed in posting date order');
        Assert.AreEqual(0, StrPos(FileText, '33.33'), 'An entry before the period is not listed');
        Assert.AreEqual(0, StrPos(FileText, '44.44'), 'An entry after the period is not listed');
        Assert.AreEqual(0, StrPos(FileText, '55.55'), 'An entry of another vehicle is not listed');
    end;

    local procedure StartHX167(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20250115D);
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();

        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Insert();
    end;

    local procedure NewContractHX167(VehicleNo: Code[20]; CustomerName: Text[100]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, CustomerName, 20250101D, 20250131D));
    end;

    local procedure AddEntryHX167(VehicleNo: Code[20]; ContractNo: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Contract No." := ContractNo;
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Insert();
    end;

    local procedure FileBytesHX167(VehicleNo: Code[20]; FromDate: Date; ToDate: Date): List of [Integer]
    var
        OwnerFile: Record "CGR Owner Ledger File" temporary;
        OwnerExport: Codeunit "CGR Owner Ledger Export";
        FileStream: InStream;
        Bytes: List of [Integer];
        FileByte: Byte;
        ByteCode: Integer;
    begin
        OwnerFile.Init();
        OwnerFile."Entry No." := 1;
        OwnerFile."Vehicle No." := VehicleNo;
        OwnerFile.Insert();

        OwnerExport.WriteOwnerLedgerFile(VehicleNo, FromDate, ToDate, OwnerFile);

        OwnerFile.Modify();
        OwnerFile.CalcFields(Content);
        OwnerFile.Content.CreateInStream(FileStream);
        while not FileStream.EOS() do begin
            FileStream.Read(FileByte);
            ByteCode := FileByte;
            Bytes.Add(ByteCode);
        end;
        exit(Bytes);
    end;

    // UTF-8 bytes of the line, then CR LF.
    local procedure AddLineHX167(var Bytes: List of [Integer]; Line: Text)
    var
        Index: Integer;
        CharCode: Integer;
        LineChar: Char;
    begin
        for Index := 1 to StrLen(Line) do begin
            LineChar := Line[Index];
            CharCode := LineChar;
            if CharCode < 128 then
                Bytes.Add(CharCode)
            else begin
                Assert.IsTrue(CharCode < 2048, 'Oracle data stays in the two-byte UTF-8 range');
                Bytes.Add(192 + (CharCode div 64));
                Bytes.Add(128 + (CharCode mod 64));
            end;
        end;
        Bytes.Add(13);
        Bytes.Add(10);
    end;

    local procedure ByteListTextHX167(Bytes: List of [Integer]): Text
    var
        ByteCode: Integer;
        Result: TextBuilder;
    begin
        Result.Append(StrSubstNo('len=%1 bytes=', Bytes.Count()));
        foreach ByteCode in Bytes do
            Result.Append(Format(ByteCode) + ' ');
        exit(Result.ToText());
    end;

    // Readable text of the file for content checks: zero bytes are skipped, other bytes above 127 read as '?'.
    local procedure AsciiTextHX167(Bytes: List of [Integer]): Text
    var
        ByteCode: Integer;
        OneChar: Text[1];
        Result: TextBuilder;
    begin
        foreach ByteCode in Bytes do
            if ByteCode <> 0 then begin
                if ByteCode > 127 then
                    ByteCode := 63;
                OneChar := ' ';
                OneChar[1] := ByteCode;
                Result.Append(OneChar);
            end;
        exit(Result.ToText());
    end;
}
