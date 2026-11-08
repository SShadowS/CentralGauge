table 70043 "CGR Saved Desk Selection"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Selection Code"; Code[20]) { }
        field(2; "Table No."; Integer) { }
    }

    keys
    {
        key(PK; "Selection Code") { Clustered = true; }
    }
}
