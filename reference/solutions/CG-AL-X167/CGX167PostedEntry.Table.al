table 71511 "CG X167 Posted Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "External Ref"; Code[30]) { DataClassification = CustomerContent; }
        field(3; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ExtRef; "External Ref") { }
    }
}
