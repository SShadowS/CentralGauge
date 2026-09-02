table 71412 "CG X157 Statement Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Cost Center Code"; Code[20]) { }
        field(2; "Period Start"; Date) { }
        field(3; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Cost Center Code", "Period Start")
        {
            Clustered = true;
        }
    }
}
