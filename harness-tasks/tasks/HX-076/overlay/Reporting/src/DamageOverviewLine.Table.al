table 70517 "CGR Damage Overview Line"
{
    TableType = Temporary;
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Open Damages"; Integer) { }
        field(3; "Oldest Open Damage"; Date) { }
        field(4; Blocked; Boolean) { }
        field(5; Note; Text[100]) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
