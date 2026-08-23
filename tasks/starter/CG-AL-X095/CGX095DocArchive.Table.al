table 70601 "CG X095 Doc Archive"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; AutoIncrement = true; }
        field(2; "Document No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Description; Text[100]) { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(DocNo; "Document No.") { Unique = true; }
    }
}
