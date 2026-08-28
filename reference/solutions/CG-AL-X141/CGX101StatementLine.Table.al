table 70611 "CG X101 Statement Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Posting Date"; Date) { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
        field(5; Description; Text[100]) { DataClassification = CustomerContent; }
        field(6; "Running Balance"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Line No.")
        {
            Clustered = true;
        }
    }
}
