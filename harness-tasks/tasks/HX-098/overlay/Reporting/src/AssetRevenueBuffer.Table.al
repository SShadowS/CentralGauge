table 70520 "CGR Asset Revenue Buffer"
{
    TableType = Temporary;
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Asset Type"; Enum "CGR Asset Type") { }
        field(2; Amount; Decimal) { }
        field(3; "Entry Count"; Integer) { }
    }

    keys
    {
        key(PK; "Asset Type") { Clustered = true; }
    }
}
