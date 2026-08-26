table 70821 "CG X122 Activity Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Doc No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Kind; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
