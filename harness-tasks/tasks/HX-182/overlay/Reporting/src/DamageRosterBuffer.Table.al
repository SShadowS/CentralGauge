table 70595 "CGR Damage Roster Buffer"
{
    DataClassification = CustomerContent;
    TableType = Temporary;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Damages Reported"; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
