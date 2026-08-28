table 70982 "CG X138 Match Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Incoming Ref"; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Match Key Used"; Code[20]) { DataClassification = CustomerContent; }
        field(4; "Matched Doc No."; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
