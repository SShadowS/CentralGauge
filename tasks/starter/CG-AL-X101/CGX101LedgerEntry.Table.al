table 70610 "CG X101 Ledger Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Account No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Posting Date"; Date) { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
        field(5; Description; Text[100]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(Statement; "Account No.", "Posting Date", "Entry No.")
        {
        }
    }
}
