codeunit 70210 "CG H005 Logger"
{
    SingleInstance = true;

    var
        LogEntries: List of [Text];

    procedure Reset()
    begin
        Clear(LogEntries);
    end;

    procedure Log(Tag: Text)
    begin
        LogEntries.Add(Tag);
    end;

    procedure GetLog(): Text
    var
        Entry: Text;
        Result: TextBuilder;
        First: Boolean;
    begin
        First := true;
        foreach Entry in LogEntries do begin
            if not First then
                Result.Append(';');
            Result.Append(Entry);
            First := false;
        end;
        exit(Result.ToText());
    end;
}

table 70207 "CG Tracked Item"
{
    DataClassification = CustomerContent;
    Caption = 'CG Tracked Item';

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            DataClassification = CustomerContent;
        }
        field(2; Description; Text[100])
        {
            Caption = 'Description';
            DataClassification = CustomerContent;
        }
        field(3; "Unit Price"; Decimal)
        {
            Caption = 'Unit Price';
            DataClassification = CustomerContent;
        }
        field(4; Blocked; Boolean)
        {
            Caption = 'Blocked';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }

    trigger OnModify()
    var
        Logger: Codeunit "CG H005 Logger";
        ChangeText: Text;
    begin
        ChangeText := DescribeChanges(xRec."Unit Price", xRec.Blocked, Rec."Unit Price", Rec.Blocked);
        if ChangeText <> '' then
            Logger.Log(ChangeText);
    end;

    procedure DescribeChanges(xUnitPrice: Decimal; xBlocked: Boolean; nUnitPrice: Decimal; nBlocked: Boolean) Result: Text
    begin
        Result := '';
        if nUnitPrice <> xUnitPrice then
            Result := 'PriceChanged';
        if (not xBlocked) and nBlocked then
            if Result <> '' then
                Result := Result + '|BlockedActivated'
            else
                Result := 'BlockedActivated';
    end;
}