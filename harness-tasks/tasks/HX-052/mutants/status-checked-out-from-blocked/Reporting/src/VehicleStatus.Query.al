query 70500 "CGR Vehicle Status"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            column(CheckedOut; Blocked) { }
            column(Mileage; Mileage) { }
        }
    }
}
