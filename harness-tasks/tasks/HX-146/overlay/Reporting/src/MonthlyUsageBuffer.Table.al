table 70560 "CGR Monthly Usage Buffer"
{
    DataClassification = CustomerContent;
    TableType = Temporary;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; Revenue; Decimal) { }
        field(3; "Km Driven"; Integer) { }
        field(4; Rentals; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
