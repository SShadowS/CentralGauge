table 70044 "CGR Saved Desk Scope Filter"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Selection Code"; Code[20]) { }
        field(2; "Filter Group"; Integer) { }
        field(3; "Field No."; Integer) { }
        field(4; "Filter Text"; Text[2048]) { }
    }

    keys
    {
        key(PK; "Selection Code", "Filter Group", "Field No.") { Clustered = true; }
    }
}
