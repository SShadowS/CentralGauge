table 71411 "CG X157 Cost Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            AutoIncrement = true;
        }
        field(2; "Cost Center Code"; Code[20]) { }
        field(3; "Posting Date"; Date) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(CC; "Cost Center Code", "Posting Date")
        {
            SumIndexFields = Amount;
        }
    }
}
