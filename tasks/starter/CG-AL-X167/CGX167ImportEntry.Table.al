table 71510 "CG X167 Import Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "External Ref"; Code[30]) { DataClassification = CustomerContent; }
        field(3; Amount; Decimal) { DataClassification = CustomerContent; }
        field(4; "Source Code"; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(SourceRef; "Source Code", "External Ref") { }
    }
}
