table 70660 "CG X106 Document"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Base Total"; Integer) { DataClassification = CustomerContent; }
        field(3; "Enrichment Note"; Text[50]) { DataClassification = CustomerContent; }
        field(4; "Archive Tag"; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
